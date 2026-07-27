import { FIRST_SHIFT_START, SECOND_SHIFT_START } from './constants';
import type { ISODateTimeString, ShiftType } from './types';

const TIME_IN_DATE_TIME_PATTERN = /T(\d{2}):(\d{2})/;

const toMinutesFromMidnight = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error(`Invalid local time: ${time}`);
  }

  return hours * 60 + minutes;
};

const getLocalTimeMinutes = (dateTime: ISODateTimeString): number => {
  const match = dateTime.match(TIME_IN_DATE_TIME_PATTERN);

  if (!match) {
    throw new Error(`Invalid date time: ${dateTime}`);
  }

  return toMinutesFromMidnight(`${match[1]}:${match[2]}`);
};

export const detectShiftType = (actualStartTime: ISODateTimeString): ShiftType => {
  const actualStartMinutes = getLocalTimeMinutes(actualStartTime);
  const firstShiftDistance = Math.abs(
    actualStartMinutes - toMinutesFromMidnight(FIRST_SHIFT_START)
  );
  const secondShiftDistance = Math.abs(
    actualStartMinutes - toMinutesFromMidnight(SECOND_SHIFT_START)
  );

  return firstShiftDistance <= secondShiftDistance ? 'first' : 'second';
};
