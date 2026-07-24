import { calculateSalaryBreakdown, type Shift } from '../../../entities/shift';
import { getDurationMinutes } from '../../../shared/lib/date-time';

export type ShiftSortCriterion =
  | 'date'
  | 'duration'
  | 'earnings'
  | 'hourlyRate'
  | 'tickets'
  | 'downtime';

export type ShiftSortDirection = 'ascending' | 'descending';

const getSortValue = (
  shift: Shift,
  criterion: ShiftSortCriterion,
  now: string
): number | string => {
  const effectiveEndTime = shift.endTime ?? now;

  switch (criterion) {
    case 'date':
      return shift.date;
    case 'duration':
      return getDurationMinutes(shift.startTime, effectiveEndTime);
    case 'earnings':
      return calculateSalaryBreakdown({
        ...shift,
        endTime: effectiveEndTime
      }).totalAmount;
    case 'hourlyRate':
      return shift.baseHourlyRateSnapshot;
    case 'tickets':
      return shift.workTickets.length;
    case 'downtime':
      return shift.workTickets.reduce(
        (total, ticket) => total + ticket.downtimeMinutes,
        0
      );
  }
};

const compareValues = (left: number | string, right: number | string): number => {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.localeCompare(right);
  }

  return Number(left) - Number(right);
};

export const sortShifts = (
  shifts: Shift[],
  criterion: ShiftSortCriterion,
  direction: ShiftSortDirection,
  now: string
): Shift[] =>
  [...shifts].sort((left, right) => {
    const directionMultiplier = direction === 'ascending' ? 1 : -1;
    const primaryDifference =
      compareValues(
        getSortValue(left, criterion, now),
        getSortValue(right, criterion, now)
      ) * directionMultiplier;

    if (primaryDifference !== 0) {
      return primaryDifference;
    }

    const dateDifference = right.date.localeCompare(left.date);

    return dateDifference !== 0 ? dateDifference : left.id.localeCompare(right.id);
  });
