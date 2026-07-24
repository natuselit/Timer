import {
  calculateGradeProductionTarget,
  type Grade,
  type GradePercentSet
} from '../../settings';
import type { ISODateTimeString, WorkTicket } from './types';

type WorkTicketBounds = {
  shiftStartTime: ISODateTimeString;
  effectiveShiftEndTime: ISODateTimeString;
  allowOpenTicket: boolean;
};

const toTimestamp = (value: ISODateTimeString, fieldName: string): number => {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    throw new Error(`Некоректний час ${fieldName}.`);
  }

  return timestamp;
};

const minutesBetween = (start: number, end: number): number =>
  Math.max(0, Math.floor((end - start) / 60_000));

const assertActualQuantity = (value: number | null): void => {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Фактична кількість має бути цілим невідʼємним числом.');
  }
};

export type TicketProductionSummary = {
  elapsedMinutes: number;
  productiveMinutes: number;
  downtimeMinutes: number;
  targets: Array<{ grade: Grade; quantity: number }>;
  currentGrade: Grade;
  currentTarget: number;
  completionPercent: number | null;
  achievedGrade: Grade | null;
};

export const calculateTicketProductionSummary = ({
  ticket,
  effectiveEndTime,
  currentGrade,
  gradeNormPercents
}: {
  ticket: WorkTicket;
  effectiveEndTime: ISODateTimeString;
  currentGrade: Grade;
  gradeNormPercents: GradePercentSet;
}): TicketProductionSummary => {
  const elapsedMinutes = minutesBetween(
    toTimestamp(ticket.startedAt, 'взяття тікета'),
    toTimestamp(effectiveEndTime, 'завершення тікета')
  );
  const downtimeMinutes = Math.min(elapsedMinutes, ticket.downtimeMinutes);
  const productiveMinutes = Math.max(0, elapsedMinutes - downtimeMinutes);
  const targets = gradeNormPercents.map((percent, index) => ({
    grade: (index + 1) as Grade,
    quantity: calculateGradeProductionTarget({
      normPerEightHours: ticket.normPerEightHours,
      gradeNormPercent: percent,
      elapsedMinutes: productiveMinutes
    })
  }));
  const currentTarget = targets[currentGrade - 1]?.quantity ?? 0;
  const achievedGrade =
    ticket.actualQuantity === null || productiveMinutes === 0
      ? null
      : ([...targets]
          .reverse()
          .find((target) => ticket.actualQuantity! >= target.quantity)?.grade ?? null);

  return {
    elapsedMinutes,
    productiveMinutes,
    downtimeMinutes,
    targets,
    currentGrade,
    currentTarget,
    completionPercent:
      ticket.actualQuantity === null || currentTarget <= 0
        ? null
        : (ticket.actualQuantity / currentTarget) * 100,
    achievedGrade
  };
};

export const validateAndSortWorkTickets = (
  workTickets: WorkTicket[],
  bounds: WorkTicketBounds
): WorkTicket[] => {
  const shiftStart = toTimestamp(bounds.shiftStartTime, 'початку зміни');
  const effectiveShiftEnd = toTimestamp(
    bounds.effectiveShiftEndTime,
    bounds.allowOpenTicket ? 'перевірки' : 'завершення зміни'
  );

  if (effectiveShiftEnd < shiftStart) {
    throw new Error('Завершення зміни має бути пізніше її початку.');
  }

  const sortedTickets = workTickets
    .map((ticket) => ({ ...ticket }))
    .sort((left, right) => {
      const startDifference = new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime();

      return startDifference !== 0 ? startDifference : left.id.localeCompare(right.id);
    });

  let previousEnd: number | null = null;
  let openTicketCount = 0;

  sortedTickets.forEach((ticket, index) => {
    const startedAt = toTimestamp(ticket.startedAt, 'взяття тікета');

    if (!Number.isFinite(ticket.normPerEightHours) || ticket.normPerEightHours <= 0) {
      throw new Error('Норма має бути більшою за 0.');
    }

    assertActualQuantity(ticket.actualQuantity);

    if (!Number.isSafeInteger(ticket.downtimeMinutes) || ticket.downtimeMinutes < 0) {
      throw new Error('Простій має бути цілою невідʼємною кількістю хвилин.');
    }

    if (startedAt < shiftStart) {
      throw new Error('Тікет не може починатися раніше зміни.');
    }

    if (startedAt > effectiveShiftEnd) {
      throw new Error(
        bounds.allowOpenTicket
          ? 'Час тікета не може бути пізніше поточного часу.'
          : 'Тікет не може починатися після завершення зміни.'
      );
    }

    if (previousEnd !== null && startedAt < previousEnd) {
      throw new Error('Час тікетів не може накладатися.');
    }

    if (ticket.endedAt === null) {
      openTicketCount += 1;

      if (ticket.actualQuantity !== null) {
        throw new Error('Фактичну кількість можна вносити лише під час завершення тікета.');
      }

      if (!bounds.allowOpenTicket) {
        throw new Error('У завершеній зміні всі тікети мають бути завершені.');
      }

      if (openTicketCount > 1 || index !== sortedTickets.length - 1) {
        throw new Error('Незавершений тікет може бути лише один і останній.');
      }

      if (ticket.downtimeMinutes > minutesBetween(startedAt, effectiveShiftEnd)) {
        throw new Error('Простій не може бути довшим за тікет.');
      }

      previousEnd = null;
      return;
    }

    const endedAt = toTimestamp(ticket.endedAt, 'завершення тікета');

    if (endedAt <= startedAt) {
      throw new Error('Завершення тікета має бути пізніше його початку.');
    }

    if (endedAt > effectiveShiftEnd) {
      throw new Error(
        bounds.allowOpenTicket
          ? 'Завершення тікета не може бути пізніше поточного часу.'
          : 'Тікет не може завершуватися пізніше зміни.'
      );
    }

    const durationMinutes = minutesBetween(startedAt, endedAt);

    if (ticket.downtimeMinutes > durationMinutes) {
      throw new Error('Простій не може бути довшим за тікет.');
    }

    previousEnd = endedAt;
  });

  return sortedTickets;
};
