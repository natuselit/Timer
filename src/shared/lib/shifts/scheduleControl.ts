import {
  calculateShiftTimeBreakdown,
  type LocalDateString,
  type Shift
} from '../../../entities/shift';

export type ScheduleControlWarning = {
  id: string;
  shiftId: string;
  date: LocalDateString;
  fingerprint: string;
  lateArrivalMinutes: number;
  earlyExitMinutes: number;
};

export type ScheduleControlSummary = {
  completedShiftCount: number;
  onScheduleShiftCount: number;
  lateArrivalMinutes: number;
  earlyExitMinutes: number;
  lateArrivalShiftCount: number;
  earlyExitShiftCount: number;
  averageLateArrivalMinutes: number;
  averageEarlyExitMinutes: number;
  scheduleAdherencePercent: number | null;
  warnings: ScheduleControlWarning[];
};

export const getScheduleWarningFingerprint = (
  shift: Pick<
    Shift,
    | 'date'
    | 'type'
    | 'plannedStartTime'
    | 'plannedEndTime'
    | 'startTime'
    | 'endTime'
  >
): string =>
  [
    shift.date,
    shift.type,
    shift.plannedStartTime,
    shift.plannedEndTime,
    shift.startTime,
    shift.endTime ?? ''
  ].join('|');

export const calculateScheduleControlSummary = (
  shifts: Shift[]
): ScheduleControlSummary => {
  const completedShifts = shifts.filter(
    (shift): shift is Shift & { endTime: string } => shift.endTime !== null
  );
  let onScheduleShiftCount = 0;
  let lateArrivalMinutes = 0;
  let earlyExitMinutes = 0;
  let lateArrivalShiftCount = 0;
  let earlyExitShiftCount = 0;
  const warnings: ScheduleControlWarning[] = [];

  completedShifts.forEach((shift) => {
    const time = calculateShiftTimeBreakdown(shift);

    lateArrivalMinutes += time.lateArrivalMinutes;
    earlyExitMinutes += time.earlyExitMinutes;

    if (time.lateArrivalMinutes > 0) {
      lateArrivalShiftCount += 1;
    }

    if (time.earlyExitMinutes > 0) {
      earlyExitShiftCount += 1;
    }

    if (time.lateArrivalMinutes === 0 && time.earlyExitMinutes === 0) {
      onScheduleShiftCount += 1;
      return;
    }

    const fingerprint = getScheduleWarningFingerprint(shift);

    warnings.push({
      id: `${shift.id}:${fingerprint}`,
      shiftId: shift.id,
      date: shift.date,
      fingerprint,
      lateArrivalMinutes: time.lateArrivalMinutes,
      earlyExitMinutes: time.earlyExitMinutes
    });
  });

  return {
    completedShiftCount: completedShifts.length,
    onScheduleShiftCount,
    lateArrivalMinutes,
    earlyExitMinutes,
    lateArrivalShiftCount,
    earlyExitShiftCount,
    averageLateArrivalMinutes:
      lateArrivalShiftCount > 0 ? lateArrivalMinutes / lateArrivalShiftCount : 0,
    averageEarlyExitMinutes:
      earlyExitShiftCount > 0 ? earlyExitMinutes / earlyExitShiftCount : 0,
    scheduleAdherencePercent:
      completedShifts.length > 0
        ? (onScheduleShiftCount / completedShifts.length) * 100
        : null,
    warnings
  };
};
