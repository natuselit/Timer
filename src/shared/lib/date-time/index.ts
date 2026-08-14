import type { ISODateTimeString, LocalDateString, LocalTimeString } from '../../../entities/shift';

export * from './timeInput';
export * from './calendarRange';

export const padTimePart = (value: number): string => String(value).padStart(2, '0');

export const getTimeZoneSuffix = (date: Date): string => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);

  return `${sign}${padTimePart(Math.floor(absoluteOffset / 60))}:${padTimePart(absoluteOffset % 60)}`;
};

export const toLocalIsoString = (date: Date): ISODateTimeString =>
  `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())}T${padTimePart(
    date.getHours()
  )}:${padTimePart(date.getMinutes())}:${padTimePart(date.getSeconds())}.${String(date.getMilliseconds()).padStart(
    3,
    '0'
  )}${getTimeZoneSuffix(date)}`;

export const getDateFromDateTime = (dateTime: ISODateTimeString): LocalDateString => {
  const [date] = dateTime.split('T');

  if (!date) {
    throw new Error(`Invalid date time: ${dateTime}`);
  }

  return date;
};

export const combineLocalDateAndTime = (
  date: LocalDateString,
  time: LocalTimeString
): ISODateTimeString => {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);

  if (!year || !month || !day || hours === undefined || minutes === undefined) {
    throw new Error('Некоректна дата або час.');
  }

  return toLocalIsoString(new Date(year, month - 1, day, hours, minutes, 0, 0));
};

export const formatTime = (dateTime: ISODateTimeString): string =>
  new Intl.DateTimeFormat('uk-UA', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(dateTime));

export const formatDate = (date: LocalDateString): string =>
  new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: 'long',
    weekday: 'short'
  }).format(new Date(`${date}T12:00:00`));

export const formatShortNumericDate = (date: LocalDateString): string => {
  const [, month, day] = date.split('-');

  if (!month || !day) {
    throw new Error(`Invalid date: ${date}`);
  }

  return `${day}.${month}`;
};

export const formatDurationClock = (durationMinutes: number): string => {
  const safeMinutes = Math.max(0, durationMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  return `${hours}:${padTimePart(minutes)}`;
};

export const formatDurationMinutes = formatDurationClock;

export const formatShortMinuteDuration = (durationMinutes: number): string => {
  const safeMinutes = Math.max(0, durationMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  return hours === 0 ? `${minutes} хв` : `${hours}:${padTimePart(minutes)}`;
};

export const addMinutesToLocalTime = (
  time: LocalTimeString,
  durationMinutes: number
): { time: LocalTimeString; dayOffset: number } => {
  const [hours, minutes] = time.split(':').map(Number);

  if (
    !Number.isSafeInteger(hours) ||
    !Number.isSafeInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    !Number.isSafeInteger(durationMinutes) ||
    durationMinutes < 0
  ) {
    throw new Error('Некоректний час або кількість хвилин.');
  }

  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const dayOffset = Math.floor(totalMinutes / (24 * 60));
  const minutesInDay = totalMinutes % (24 * 60);

  return {
    time: `${padTimePart(Math.floor(minutesInDay / 60))}:${padTimePart(minutesInDay % 60)}`,
    dayOffset
  };
};

export const getDurationMinutes = (
  startTime: ISODateTimeString,
  endTime: ISODateTimeString
): number =>
  Math.max(0, Math.floor((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60_000));

export const getCurrentMonth = (): { year: number; month: number } => {
  const now = new Date();

  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1
  };
};
