import {
  detectShiftType,
  getPlannedShiftWindow,
  type LocalDateString,
  type LocalTimeString,
  type ShiftType
} from '../../shift';

const DATE_HEADER_PATTERN = /^--(\d{2})\.(\d{2})\.(\d{4})--$/;
const FIELD_PATTERN = /^(In time|Out time|Total):\s*(?:(\d{2}:\d{2})|:)?$/;
const COLUMN_HEADER_PATTERN = /^Колонка\s+\d+:$/i;
const MINUTES_IN_DAY = 24 * 60;

type ScheduleField = 'inTime' | 'outTime' | 'total';

type RawScheduleBlock = {
  line: number;
  date: LocalDateString;
  lines: string[];
};

export type ParsedEnterpriseScheduleItem = {
  date: LocalDateString;
  shiftType: ShiftType;
  plannedStartTime: LocalTimeString;
  plannedEndTime: LocalTimeString;
  inTime: LocalTimeString;
  outTime: LocalTimeString;
  total: LocalTimeString;
  sourceText: string;
};

export type EnterpriseScheduleParseError = {
  line: number;
  message: string;
  sourceText: string;
};

export type EnterpriseScheduleParseResult = {
  items: ParsedEnterpriseScheduleItem[];
  errors: EnterpriseScheduleParseError[];
};

const toDate = (day: string, month: string, year: string): LocalDateString =>
  `${year}-${month}-${day}`;

const isExistingDate = (date: LocalDateString): boolean => {
  const [year, month, day] = date.split('-').map(Number);
  const candidate = new Date(year, month - 1, day);

  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === month - 1 &&
    candidate.getDate() === day
  );
};

const toMinutes = (time: LocalTimeString): number | null => {
  const [hours, minutes] = time.split(':').map(Number);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
};

const toDurationMinutes = (time: LocalTimeString): number | null => {
  const [hours, minutes] = time.split(':').map(Number);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
};

const isEmptyScheduleValue = (value: string | undefined): value is undefined =>
  value === undefined;

const isDayOffBlock = (fields: Partial<Record<ScheduleField, LocalTimeString | undefined>>): boolean =>
  isEmptyScheduleValue(fields.inTime) &&
  isEmptyScheduleValue(fields.outTime) &&
  (isEmptyScheduleValue(fields.total) || fields.total === '00:00');

const getDurationMinutes = (startTime: LocalTimeString, endTime: LocalTimeString): number | null => {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);

  if (start === null || end === null || end < start) {
    return null;
  }

  return end - start;
};

const splitBlocks = (source: string): {
  blocks: RawScheduleBlock[];
  errors: EnterpriseScheduleParseError[];
} => {
  const blocks: RawScheduleBlock[] = [];
  const errors: EnterpriseScheduleParseError[] = [];
  let currentBlock: RawScheduleBlock | null = null;

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line) {
      return;
    }

    if (COLUMN_HEADER_PATTERN.test(line)) {
      return;
    }

    const dateMatch = line.match(DATE_HEADER_PATTERN);

    if (dateMatch) {
      const date = toDate(dateMatch[1], dateMatch[2], dateMatch[3]);

      if (!isExistingDate(date)) {
        errors.push({
          line: lineNumber,
          message: 'Некоректна дата в заголовку блоку.',
          sourceText: line
        });
        currentBlock = null;
        return;
      }

      currentBlock = {
        line: lineNumber,
        date,
        lines: [line]
      };
      blocks.push(currentBlock);
      return;
    }

    if (!currentBlock) {
      errors.push({
        line: lineNumber,
        message: 'Рядок має бути всередині блоку з датою --дд.мм.рррр--.',
        sourceText: line
      });
      return;
    }

    currentBlock.lines.push(line);
  });

  return { blocks, errors };
};

const parseBlock = (
  block: RawScheduleBlock
): ParsedEnterpriseScheduleItem | EnterpriseScheduleParseError | null => {
  const fields: Partial<Record<ScheduleField, LocalTimeString | undefined>> = {};
  const presentFields = new Set<ScheduleField>();

  for (const line of block.lines.slice(1)) {
    const match = line.match(FIELD_PATTERN);

    if (!match) {
      return {
        line: block.line,
        message: `Некоректний рядок у блоці ${block.date}: "${line}".`,
        sourceText: block.lines.join('\n')
      };
    }

    const [, fieldName, value] = match;
    const field =
      fieldName === 'In time' ? 'inTime' : fieldName === 'Out time' ? 'outTime' : 'total';

    if (presentFields.has(field)) {
      return {
        line: block.line,
        message: `Поле "${fieldName}" повторюється у блоці ${block.date}.`,
        sourceText: block.lines.join('\n')
      };
    }

    presentFields.add(field);
    fields[field] = value;
  }

  if (presentFields.size === 0) {
    return null;
  }

  if (
    presentFields.has('inTime') &&
    presentFields.has('outTime') &&
    presentFields.has('total') &&
    isDayOffBlock(fields)
  ) {
    return null;
  }

  if (!fields.inTime || !fields.outTime || !fields.total) {
    return {
      line: block.line,
      message: `У блоці ${block.date} мають бути In time, Out time і Total.`,
      sourceText: block.lines.join('\n')
    };
  }

  const actualDuration = getDurationMinutes(fields.inTime, fields.outTime);
  const reportedDuration = toDurationMinutes(fields.total);

  if (actualDuration === null || reportedDuration === null) {
    return {
      line: block.line,
      message: `У блоці ${block.date} некоректний час.`,
      sourceText: block.lines.join('\n')
    };
  }

  if (actualDuration !== reportedDuration) {
    return {
      line: block.line,
      message: `У блоці ${block.date} Total не збігається з In time та Out time.`,
      sourceText: block.lines.join('\n')
    };
  }

  if (actualDuration <= 0 || actualDuration >= MINUTES_IN_DAY) {
    return {
      line: block.line,
      message: `У блоці ${block.date} тривалість зміни має бути більшою за 0 і меншою за 24 години.`,
      sourceText: block.lines.join('\n')
    };
  }

  const startDateTime = `${block.date}T${fields.inTime}:00.000`;
  const shiftType = detectShiftType(startDateTime);
  const plannedWindow = getPlannedShiftWindow(block.date, shiftType, startDateTime);

  return {
    date: block.date,
    shiftType,
    plannedStartTime: plannedWindow.startTime,
    plannedEndTime: plannedWindow.endTime,
    inTime: fields.inTime,
    outTime: fields.outTime,
    total: fields.total,
    sourceText: block.lines.join('\n')
  };
};

export const parseEnterpriseScheduleText = (source: string): EnterpriseScheduleParseResult => {
  const { blocks, errors } = splitBlocks(source);
  const items: ParsedEnterpriseScheduleItem[] = [];
  const seenDates = new Set<LocalDateString>();

  for (const block of blocks) {
    if (seenDates.has(block.date)) {
      errors.push({
        line: block.line,
        message: `Дата ${block.date} повторюється. Один день може мати лише один запис графіка.`,
        sourceText: block.lines.join('\n')
      });
      continue;
    }

    const parsed = parseBlock(block);

    if (parsed === null) {
      seenDates.add(block.date);
      continue;
    }

    if ('message' in parsed) {
      errors.push(parsed);
      continue;
    }

    seenDates.add(parsed.date);
    items.push(parsed);
  }

  return { items, errors };
};
