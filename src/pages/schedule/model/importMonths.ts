import type { ParsedEnterpriseScheduleItem } from '../../../entities/enterprise-schedule';

export type CalendarMonth = {
  year: number;
  month: number;
};

export type ImportedMonth = CalendarMonth & {
  count: number;
  key: string;
};

export const getImportedMonths = (
  items: Array<Pick<ParsedEnterpriseScheduleItem, 'date'>>
): ImportedMonth[] => {
  const countByMonth = new Map<string, number>();

  items.forEach((item) => {
    const key = item.date.slice(0, 7);
    countByMonth.set(key, (countByMonth.get(key) ?? 0) + 1);
  });

  return [...countByMonth.entries()]
    .map(([key, count]) => {
      const [year, month] = key.split('-').map(Number);

      return { year, month, count, key };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
};

export const getPrimaryImportedMonth = (
  items: Array<Pick<ParsedEnterpriseScheduleItem, 'date'>>
): CalendarMonth | null => {
  const primaryMonth = [...getImportedMonths(items)].sort(
    (left, right) => right.count - left.count || right.key.localeCompare(left.key)
  )[0];

  return primaryMonth ? { year: primaryMonth.year, month: primaryMonth.month } : null;
};
