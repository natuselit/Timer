import { BUILT_IN_SHIFT_TEMPLATES } from './constants';
import type { ISODateTimeString, ShiftTemplate, ShiftTemplateId, ShiftType } from './types';

const TIME_IN_DATE_TIME_PATTERN = /T(\d{2}):(\d{2})/;

export const toMinutesFromMidnight = (time: string): number => {
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
  return detectShiftTemplate(actualStartTime, BUILT_IN_SHIFT_TEMPLATES);
};

export const getCyclicTimeDistanceMinutes = (
  leftMinutes: number,
  rightMinutes: number
): number => {
  const directDistance = Math.abs(leftMinutes - rightMinutes);

  return Math.min(directDistance, 24 * 60 - directDistance);
};

export const detectShiftTemplate = (
  actualStartTime: ISODateTimeString,
  templates: readonly Pick<ShiftTemplate, 'id' | 'startTime' | 'enabled'>[]
): ShiftTemplateId => {
  const actualStartMinutes = getLocalTimeMinutes(actualStartTime);
  const enabledTemplates = templates.filter((template) => template.enabled);

  if (enabledTemplates.length === 0) {
    throw new Error('Немає активних шаблонів змін.');
  }

  return enabledTemplates.reduce((nearest, template) => {
    const nearestDistance = getCyclicTimeDistanceMinutes(
      actualStartMinutes,
      toMinutesFromMidnight(nearest.startTime)
    );
    const templateDistance = getCyclicTimeDistanceMinutes(
      actualStartMinutes,
      toMinutesFromMidnight(template.startTime)
    );

    return templateDistance < nearestDistance ? template : nearest;
  }).id;
};
