import type { ISODateTimeString, LocalTimeString } from '../../../entities/shift';

const MAX_HOURS = 23;
const MAX_MINUTES = 59;

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

const toDigits = (value: string, maxLength: number): string =>
  value.replace(/\D/g, '').slice(0, maxLength);

const toNumber = (value: string): number => (value ? Number(value) : 0);

const padTimePart = (value: number): string => String(value).padStart(2, '0');

const parseDigits = (digits: string): { hours: number; minutes: number } => {
  if (digits.length <= 2) {
    return { hours: toNumber(digits), minutes: 0 };
  }

  if (digits.length === 3) {
    const firstTwoDigits = toNumber(digits.slice(0, 2));

    return firstTwoDigits <= MAX_HOURS
      ? { hours: firstTwoDigits, minutes: toNumber(digits.slice(2)) * 10 }
      : { hours: toNumber(digits.slice(0, 1)), minutes: toNumber(digits.slice(1)) };
  }

  return {
    hours: toNumber(digits.slice(0, 2)),
    minutes: toNumber(digits.slice(2, 4))
  };
};

const parseColonValue = (value: string): { hours: number; minutes: number } => {
  const [rawHours = '', rawMinutes = ''] = value.split(':');
  const hours = toDigits(rawHours, 2);
  const minutes = toDigits(rawMinutes, 2);

  return {
    hours: toNumber(hours),
    minutes: minutes.length === 1 ? toNumber(minutes) * 10 : toNumber(minutes)
  };
};

export const normalizeTimeInput = (value: string): LocalTimeString => {
  const parsed = value.includes(':') ? parseColonValue(value) : parseDigits(toDigits(value, 4));
  const hours = clamp(parsed.hours, MAX_HOURS);
  const minutes = clamp(parsed.minutes, MAX_MINUTES);

  return `${padTimePart(hours)}:${padTimePart(minutes)}`;
};

export const formatTimeInputDraft = (value: string): string => {
  if (value.includes(':')) {
    const [rawHours = '', rawMinutes = ''] = value.split(':');
    const hours = toDigits(rawHours, 2);
    const minutes = toDigits(rawMinutes, 2);

    return `${hours}:${minutes}`;
  }

  const digits = toDigits(value, 4);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length === 3) {
    const firstTwoDigits = toNumber(digits.slice(0, 2));

    return firstTwoDigits <= MAX_HOURS
      ? `${digits.slice(0, 2)}:${digits.slice(2)}`
      : `${digits.slice(0, 1)}:${digits.slice(1)}`;
  }

  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
};

export const getTimeInputValue = (dateTime: ISODateTimeString): LocalTimeString =>
  dateTime.slice(11, 16);
