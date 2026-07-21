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

      if (!bounds.allowOpenTicket) {
        throw new Error('У завершеній зміні всі тікети мають бути завершені.');
      }

      if (openTicketCount > 1 || index !== sortedTickets.length - 1) {
        throw new Error('Незавершений тікет може бути лише один і останній.');
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

    previousEnd = endedAt;
  });

  return sortedTickets;
};
